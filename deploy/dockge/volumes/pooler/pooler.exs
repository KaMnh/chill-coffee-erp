# Minimal Supavisor pooler tenant config for Chill Coffee ERP self-hosted Supabase.
# Replace with the official supabase/docker pooler.exs from
# https://github.com/supabase/supabase/blob/master/docker/volumes/pooler/pooler.exs
# if you need multi-tenant pooler features.

if !System.get_env("POSTGRES_PASSWORD") do
  raise "POSTGRES_PASSWORD is required"
end

{:ok, _} = Application.ensure_all_started(:supavisor)

{:ok, _version} =
  Supavisor.Repo.query("SELECT version()", [])
  |> case do
    {:ok, %{rows: [[v]]}} -> {:ok, v}
    other -> other
  end

tenant_id = System.get_env("POOLER_TENANT_ID", "chill-coffee-erp")

{:ok, _} = Supavisor.Tenants.create_tenant(%{
  external_id: tenant_id,
  db_host: System.get_env("POSTGRES_HOST", "db"),
  db_port: String.to_integer(System.get_env("POSTGRES_PORT", "5432")),
  db_database: System.get_env("POSTGRES_DB", "postgres"),
  db_user: "supabase_admin",
  db_password: System.get_env("POSTGRES_PASSWORD"),
  default_parameter_status: %{},
  ip_version: :v4
})
