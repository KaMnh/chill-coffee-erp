// scripts/migrate/_lib/sql-parser.mjs — regex parser CREATE TABLE statements
// cho mục đích diff schema. KHÔNG phải general SQL parser — chỉ đủ cho dump file
// từ pg_dump/Supabase Dashboard.
//
// Output shape: { [tableName]: { [columnName]: { type, nullable, default, fk } } }
// type        : string (lowercase, không bao gồm modifier như "(10,2)")
// nullable    : boolean (true nếu không có NOT NULL)
// default     : string | null (raw default expression)
// fk          : { table: string, column: string|null } | null

const COMMENT_RE = /--[^\n]*/g;
const TABLE_HEAD_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s*\(/gi;
const CONSTRAINT_LINE_RE = /^(?:constraint\b|primary\s+key\b|unique\s*\(|foreign\s+key\b|check\s*\(|exclude\b)/i;
const COL_HEAD_RE = /^"?(\w+)"?\s+("?[\w]+"?(?:\s*\([\d,\s]*\))?)/;
const FK_RE = /\breferences\s+(?:"?(\w+)"?\.)?"?(\w+)"?\s*(?:\(\s*"?(\w+)"?\s*\))?/i;
const DEFAULT_RE = /\bdefault\s+(.+?)(?=\s+(?:not\s+null|null\b|references|check|generated|primary\s+key|unique|$))/i;
const NOT_NULL_RE = /\bnot\s+null\b/i;

/** Strip line comments. Block comments hiếm trong pg_dump → bỏ qua. */
function stripComments(sql) {
  return sql.replace(COMMENT_RE, "");
}

/** Tìm vị trí kết thúc của block ngoặc tròn bắt đầu tại startIdx (sau dấu `(`). */
function findMatchingParen(sql, startIdx) {
  let depth = 1;
  let i = startIdx;
  let inSingleQuote = false;
  let inDollarQuote = false;
  let dollarTag = "";
  while (i < sql.length && depth > 0) {
    const ch = sql[i];
    if (!inDollarQuote && ch === "'" && sql[i - 1] !== "\\") {
      inSingleQuote = !inSingleQuote;
    } else if (!inSingleQuote && ch === "$") {
      // dollar-quoted strings: $tag$...$tag$
      const m = sql.slice(i).match(/^\$(\w*)\$/);
      if (m) {
        if (!inDollarQuote) {
          inDollarQuote = true;
          dollarTag = m[0];
        } else if (m[0] === dollarTag) {
          inDollarQuote = false;
          dollarTag = "";
        }
        i += m[0].length;
        continue;
      }
    } else if (!inSingleQuote && !inDollarQuote) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    i++;
  }
  return depth === 0 ? i - 1 : -1;
}

/** Split chuỗi theo dấu phẩy ở top-level (không trong ngoặc). */
function splitTopLevelCommas(s) {
  const out = [];
  let depth = 0;
  let buf = "";
  let inQuote = false;
  for (const ch of s) {
    if (ch === "'" && !inQuote) inQuote = true;
    else if (ch === "'" && inQuote) inQuote = false;
    if (!inQuote) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    if (ch === "," && depth === 0 && !inQuote) {
      out.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
}

function normalizeType(rawType) {
  let t = rawType.replace(/"/g, "").trim().toLowerCase();
  // strip modifier như (10,2), (100), (n,m)
  t = t.replace(/\s*\([\d,\s]*\)/, "");
  // unify aliases
  const aliases = {
    "timestamp with time zone": "timestamptz",
    "timestamp without time zone": "timestamp",
    "character varying": "varchar",
    "boolean": "bool",
    "integer": "int4",
    "bigint": "int8",
    "smallint": "int2",
    "double precision": "float8",
    "real": "float4",
  };
  return aliases[t] || t;
}

/** Parse 1 column line trả về { name, def } hoặc null nếu là constraint line. */
function parseColumnLine(line) {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  if (CONSTRAINT_LINE_RE.test(trimmed)) return null;

  const head = trimmed.match(COL_HEAD_RE);
  if (!head) return null;

  const name = head[1];
  const type = normalizeType(head[2]);
  const rest = trimmed.slice(head[0].length);

  const nullable = !NOT_NULL_RE.test(rest);
  const dm = rest.match(DEFAULT_RE);
  const defaultExpr = dm ? dm[1].trim().replace(/,$/, "") : null;
  const fkm = rest.match(FK_RE);
  const fk = fkm ? { table: fkm[2], column: fkm[3] || null } : null;

  return { name, def: { type, nullable, default: defaultExpr, fk } };
}

/**
 * Parse all CREATE TABLE statements trong file SQL.
 * @param {string} sql
 * @param {object} [opts]
 * @param {string} [opts.schema='public'] - chỉ parse bảng trong schema này
 * @returns {Record<string, Record<string, {type:string,nullable:boolean,default:string|null,fk:object|null}>>}
 */
export function parseCreateTables(sql, opts = {}) {
  const targetSchema = opts.schema || "public";
  const cleaned = stripComments(sql);
  const tables = {};

  TABLE_HEAD_RE.lastIndex = 0;
  let m;
  while ((m = TABLE_HEAD_RE.exec(cleaned)) !== null) {
    const schema = m[1] || "public";
    const tableName = m[2];
    if (schema !== targetSchema) continue;

    const bodyStart = TABLE_HEAD_RE.lastIndex;
    const bodyEnd = findMatchingParen(cleaned, bodyStart);
    if (bodyEnd < 0) continue;

    const body = cleaned.slice(bodyStart, bodyEnd);
    const columns = {};
    for (const line of splitTopLevelCommas(body)) {
      const parsed = parseColumnLine(line);
      if (parsed) columns[parsed.name] = parsed.def;
    }
    tables[tableName] = columns;

    TABLE_HEAD_RE.lastIndex = bodyEnd + 1;
  }
  return tables;
}

/**
 * Parse ALTER TABLE ... ADD COLUMN statements (pg_dump sometimes splits cols out).
 * Trả về list patches để apply vào kết quả parseCreateTables.
 */
export function parseAlterAddColumn(sql) {
  const cleaned = stripComments(sql);
  const re = /alter\s+table\s+(?:only\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?\s+([\s\S]+?);/gi;
  const patches = [];
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const schema = m[1] || "public";
    if (schema !== "public") continue;
    const tableName = m[2];
    const colName = m[3];
    const typeDef = m[4].trim();
    const typeMatch = typeDef.match(/^("?[\w]+"?(?:\s*\([\d,\s]*\))?)/);
    if (!typeMatch) continue;
    const type = normalizeType(typeMatch[1]);
    const rest = typeDef.slice(typeMatch[0].length);
    const nullable = !NOT_NULL_RE.test(rest);
    const dm = rest.match(DEFAULT_RE);
    const defaultExpr = dm ? dm[1].trim().replace(/,$/, "") : null;
    patches.push({
      table: tableName,
      column: colName,
      def: { type, nullable, default: defaultExpr, fk: null },
    });
  }
  return patches;
}

/** Áp patches vào parsed schema (in-place). */
export function applyPatches(tables, patches) {
  for (const p of patches) {
    if (!tables[p.table]) tables[p.table] = {};
    if (!tables[p.table][p.column]) tables[p.table][p.column] = p.def;
  }
}
