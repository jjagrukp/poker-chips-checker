import { useEffect, useRef, useState } from 'react';
import type { Inventory } from '@/features/chip-inventory/domain/inventory';
import { mergeProposals } from '@/features/chip-inventory/photo/to-rows';
import { InventoryReview } from '@/features/chip-inventory/ui/InventoryReview';
import { PhotoImport } from '@/features/chip-inventory/ui/PhotoImport';
import { rowsReport, suggestRowValues, toInventory } from '@/features/chip-inventory/ui/rows';
import { buttonSecondary, card, hint } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';
import {
  confirmInventory,
  DEFAULT_INVENTORY_NAME,
  loadInventory,
  setInventoryName,
  setRows,
} from '../../state/wizard';
import { useUpdate, useWizard, useWizardEnv } from '../context';

// Step 3 (spec 01 §5): a saved set, a photo (spec 06, when enabled) or manual entry, all
// ending on the same review. Photo proposals arrive as unconfirmed rows.

export function ChipsStep() {
  const t = useT();
  const { repos, ctx, photo } = useWizardEnv();
  const update = useUpdate();
  const draft = useWizard((s) => s.draft);
  const [saved, setSaved] = useState<Inventory[]>([]);
  const [saveFailed, setSaveFailed] = useState(false);
  const reviewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    repos.inventories.list().then(
      (list) => !cancelled && setSaved([...list].sort((a, b) => b.updatedAt - a.updatedAt)),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [repos]);

  const meta = { id: draft.inventoryId, name: draft.inventoryName, updatedAt: 0 };
  const report = rowsReport(toInventory(draft.rows, meta));

  const confirm = async () => {
    const rows = draft.rows;
    const name = draft.inventoryName.trim() || DEFAULT_INVENTORY_NAME;
    const { inventory, assignment } = toInventory(rows, {
      id: draft.inventoryId,
      name,
      updatedAt: ctx.clock.now(),
    });
    if (rowsReport({ inventory, assignment }).errors.length > 0) return;
    try {
      await repos.inventories.put(inventory);
      setSaveFailed(false);
      // Rows edited while saving win: confirm only the rows that were saved.
      update((s) => (s.draft.rows === rows ? confirmInventory(s, inventory, assignment) : s));
    } catch {
      setSaveFailed(true);
    }
  };

  return (
    <section className="flex flex-col gap-6">
      {saved.length > 0 && (
        <div className={`${card} flex flex-col gap-2`}>
          <h2 className="font-semibold">{t('setup.chips.saved')}</h2>
          <ul className="flex flex-wrap gap-2">
            {saved.map((inventory) => (
              <li key={inventory.id}>
                <button
                  type="button"
                  className={buttonSecondary + ' bg-surface'}
                  aria-pressed={inventory.id === draft.inventoryId}
                  onClick={() => update((s) => loadInventory(s, inventory))}
                >
                  {t('setup.chips.savedItem', {
                    name: inventory.name,
                    types: inventory.chipTypes.length,
                  })}
                </button>
              </li>
            ))}
          </ul>
          <p className={hint}>{t('setup.chips.savedHint')}</p>
        </div>
      )}
      {photo && (
        <PhotoImport
          service={photo}
          onProposals={(proposals) =>
            update((s) => setRows(s, mergeProposals(s.draft.rows, proposals, ctx.newId)))
          }
          onManual={() => reviewRef.current?.focus()}
        />
      )}
      <p className={hint}>{t('setup.chips.manualHint')}</p>

      <div ref={reviewRef} tabIndex={-1} className="outline-none">
        <InventoryReview
          name={draft.inventoryName}
          rows={draft.rows}
          report={report}
          confirmed={draft.confirmed !== null}
          newId={ctx.newId}
          onNameChange={(name) => update((s) => setInventoryName(s, name))}
          onRowsChange={(rows) => update((s) => setRows(s, rows))}
          onSuggest={() => update((s) => setRows(s, suggestRowValues(s.draft.rows, meta)))}
          onConfirm={() => void confirm()}
        />
      </div>
      {saveFailed && <p role="alert">{t('setup.chips.saveFailed')}</p>}
    </section>
  );
}
