// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
let code = fs.readFileSync('components/admin/master-schedule-grid.tsx', 'utf8');

// Imports
code = code.replace(
  'import { ConfirmServiceDialog } from "@/components/client/confirm-service-dialog";',
  `import { ConfirmServiceDialog } from "@/components/client/confirm-service-dialog";
import { useUndoStack } from "@/hooks/use-undo-stack";
import { useWarnUnsaved } from "@/hooks/use-warn-unsaved";
import { GridOperation } from "@/lib/master-schedule-core";`
);

code = code.replace(
  'UserMinus,\n} from "lucide-react";',
  `UserMinus,
  Save,
  Undo2,
  Redo2,
} from "lucide-react";`
);

code = code.replace(
  'approveShiftCancellation,\n  rejectShiftCancellation,\n} from "@/app/[locale]/admin/schedule/actions";',
  `approveShiftCancellation,
  rejectShiftCancellation,
  saveMasterScheduleGridBatch,
} from "@/app/[locale]/admin/schedule/actions";`
);

// State setup
code = code.replace(
  `  const [legendOpen, setLegendOpen] = useState(false);`,
  `  const [legendOpen, setLegendOpen] = useState(false);

  const { state: undoState, set: setUndoState, undo, redo, canUndo, canRedo, clearHistory, replace } = useUndoStack<{
    rows: GridWorkerRow[];
    unassigned: UnassignedShift[];
    ops: GridOperation[];
  }>({ rows, unassigned, ops: [] });

  const localRows = undoState.rows;
  const localUnassigned = undoState.unassigned;
  const ops = undoState.ops;

  useWarnUnsaved(ops.length > 0);

  // Sync on props change (if someone else saves or revalidation happens)
  useEffect(() => {
    if (ops.length === 0) {
      replace({ rows, unassigned, ops: [] });
    }
  }, [rows, unassigned]);

  const [pending, startTransition] = useTransition();

  function saveBatch() {
    if (ops.length === 0) return;
    startTransition(async () => {
      const res = await saveMasterScheduleGridBatch(ops);
      if (res.ok) {
        toast.success(t("saved"));
        clearHistory();
        router.refresh();
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  function addLocalOperation(
    op: GridOperation,
    updater: (draft: { rows: GridWorkerRow[]; unassigned: UnassignedShift[] }) => void
  ) {
    setUndoState(prev => {
      const nextRows = structuredClone(prev.rows);
      const nextUnassigned = structuredClone(prev.unassigned);
      updater({ rows: nextRows, unassigned: nextUnassigned });
      return { rows: nextRows, unassigned: nextUnassigned, ops: [...prev.ops, op] };
    });
  }`
);

// Replace rows -> localRows, unassigned -> localUnassigned
code = code.replace(
  `layoutUnassigned(unassigned, daysInMonth),`,
  `layoutUnassigned(localUnassigned, daysInMonth),`
);
code = code.replace(/targetRow = target \? rows\./g, "targetRow = target ? localRows.");
code = code.replace(/infoRow = infoWorkerId \? rows\./g, "infoRow = infoWorkerId ? localRows.");
code = code.replace(/if \(rows\.length === 0\)/g, "if (localRows.length === 0)");
code = code.replace(/\{rows\.map\(\(r\)/g, "{localRows.map((r)");

// Add floating save bar
code = code.replace(
  `{/* Floating legend:`,
  `
      {ops.length > 0 && (
        <div className="fixed bottom-6 start-1/2 z-50 -translate-x-1/2 flex items-center gap-2 rounded-full border bg-background p-1.5 shadow-lg">
          <div className="flex items-center rounded-full border bg-muted/50 px-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              disabled={!canUndo || pending}
              onClick={undo}
            >
              <Undo2 className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              disabled={!canRedo || pending}
              onClick={redo}
            >
              <Redo2 className="size-4" />
            </Button>
          </div>
          <div className="px-3 text-sm font-medium text-muted-foreground border-e pr-4">
            {ops.length} {t("unsavedChanges") || "Änderungen"}
          </div>
          <Button onClick={saveBatch} disabled={pending} className="rounded-full gap-2 px-5">
            <Save className="size-4" />
            {pending ? t("saving") || "Speichern..." : t("save") || "Speichern"}
          </Button>
        </div>
      )}

      {/* Floating legend:`
);

// Pass addLocalOperation to editors
code = code.replace(
  `locale={locale}\n            />`,
  `locale={locale}
              addLocalOperation={addLocalOperation}
            />`
);
code = code.replace(
  `onDone={() => setOpenShift(null)}\n            />`,
  `onDone={() => setOpenShift(null)}
              addLocalOperation={addLocalOperation}
            />`
);
code = code.replace(
  `onDone={() => setNewOrderDay(null)}\n            />`,
  `onDone={() => setNewOrderDay(null)}
              addLocalOperation={addLocalOperation}
            />`
);

fs.writeFileSync('components/admin/master-schedule-grid.tsx', code);
