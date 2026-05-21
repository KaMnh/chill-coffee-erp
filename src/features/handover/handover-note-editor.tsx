"use client";

import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useUpdateHandoverNote } from "@/hooks/mutations/use-handover-mutations";
import { limits } from "@/lib/validation";
import { formatTime } from "@/lib/format";

interface HandoverNoteEditorProps {
  sessionId: string;
  businessDate: string;
  note: string;
  disabled: boolean;
}

/**
 * Handover note — save-on-blur. No explicit Save button.
 *
 * Internal state:
 *   - currentNote: what user is editing
 *   - lastSavedNote: snapshot from last successful save
 *   - lastSavedAt: timestamp for "Đã lưu lúc X" indicator
 *
 * Initialized from `note` prop. Refetch can update the source note —
 * useEffect([note]) re-syncs both currentNote and lastSavedNote.
 *
 * On blur: if currentNote !== lastSavedNote && valid → fires
 * useUpdateHandoverNote → on success, updates lastSavedNote + lastSavedAt.
 *
 * Helper text states:
 *   - isBusy: "Đang lưu..."
 *   - dirty: "Sẽ lưu khi rời ô"
 *   - lastSavedAt set: "Đã lưu lúc {time}"
 *   - default: "{N}/{limit} ký tự"
 */
export function HandoverNoteEditor({
  sessionId,
  businessDate,
  note,
  disabled
}: HandoverNoteEditorProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const updateM = useUpdateHandoverNote(supabase, businessDate);

  const [currentNote, setCurrentNote] = useState(note);
  const [lastSavedNote, setLastSavedNote] = useState(note);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // Refetch-driven re-sync: if the source note changes (e.g., owner edited in
  // another tab), update both currentNote and lastSavedNote so we don't
  // overwrite their change on next blur.
  useEffect(() => {
    setCurrentNote(note);
    setLastSavedNote(note);
  }, [note]);

  const noteLen = currentNote.length;
  const tooLong = noteLen > limits.note;
  const isDirty = currentNote !== lastSavedNote;
  const isBusy = updateM.isPending;

  async function handleBlur() {
    if (disabled || isBusy || !isDirty || tooLong) return;
    try {
      await updateM.mutateAsync({ sessionId, note: currentNote });
      setLastSavedNote(currentNote);
      setLastSavedAt(new Date());
      toast({ semantic: "success", message: "Đã lưu ghi chú." });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không lưu được ghi chú."
      });
    }
  }

  const helperText = isBusy
    ? "Đang lưu..."
    : isDirty
      ? "Sẽ lưu khi rời ô"
      : lastSavedAt
        ? `Đã lưu lúc ${formatTime(lastSavedAt.toISOString())}`
        : `${noteLen}/${limits.note} ký tự`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ghi chú bàn giao</CardTitle>
      </CardHeader>
      <CardBody>
        <Textarea
          value={currentNote}
          onChange={(e) => setCurrentNote(e.target.value)}
          onBlur={handleBlur}
          disabled={disabled || isBusy}
          rows={4}
          maxLength={limits.note + 100}
          placeholder="Ghi chú đặc biệt cho ca sau (vd: thiếu nguyên liệu A, máy POS chậm, khách phàn nàn...)"
          helper={helperText}
          error={tooLong ? `Vượt ${limits.note} ký tự.` : undefined}
        />
      </CardBody>
    </Card>
  );
}
