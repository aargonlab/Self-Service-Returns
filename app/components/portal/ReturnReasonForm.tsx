import { useTranslation } from "~/utils/useTranslation";

type Reason = {
  id: string;
  code: string;
  label: string;
  requiresNote: boolean;
  appliesToReturn: boolean;
  appliesToReplacement: boolean;
};

type Props = {
  reasons: Reason[];
  returnReason: string;
  returnResolution: string;
  returnNote: string;
  selectedItems: Set<string>;
  enableSerialNumbers: boolean;
  serialNumberItems: any[];
  eligibleItems: any[];
  resolutionOptions: {
    enableReplacement: boolean;
    excludeReplacementForRxGroup: boolean;
  };
  onReasonChange: (reasonId: string) => void;
  onResolutionChange: (resolution: string) => void;
  onNoteChange: (note: string) => void;
};

export function ReturnReasonForm({
  reasons,
  returnReason,
  returnResolution,
  returnNote,
  selectedItems,
  enableSerialNumbers,
  serialNumberItems,
  eligibleItems,
  resolutionOptions,
  onReasonChange,
  onResolutionChange,
  onNoteChange,
}: Props) {
  const { t } = useTranslation();

  if (selectedItems.size === 0) return null;

  const selectedReasonObj = reasons.find(r => r.id === returnReason);

  // Check if ANY selected item is RX grouped
  const hasRxGroupedItem = (() => {
    let found = false;
    if (enableSerialNumbers && serialNumberItems.length > 0) {
      found = Array.from(selectedItems).some(itemKey => {
        if (!itemKey.startsWith("sn_")) return false;
        const sn = itemKey.replace("sn_", "");
        const snItem = serialNumberItems.find(s => s.serialNumber === sn);
        return snItem?.groupedItemTitles && snItem.groupedItemTitles.length > 0;
      });
    }
    if (found) return true;
    return Array.from(selectedItems).some(itemId => {
      if (itemId.startsWith("sn_")) return false;
      const item = eligibleItems.find(i => i.lineItemId === itemId);
      return item?.groupedLineItemIds && item.groupedLineItemIds.length > 1;
    });
  })();

  const rxReplacementExcluded = hasRxGroupedItem && resolutionOptions.excludeReplacementForRxGroup;
  const canRefund = selectedReasonObj?.appliesToReturn ?? false;
  const canReplace = (selectedReasonObj?.appliesToReplacement ?? false) && resolutionOptions.enableReplacement && !rxReplacementExcluded;

  return (
    <div className="portal-card mt-4">
      <h3 className="text-md font-semibold text-gray-900 mb-3">
        {t("portal.new.reasonSectionTitle")}
      </h3>

      {/* Reason dropdown */}
      <div className="mb-3">
        <label className="portal-label">{t("portal.new.reasonLabel")}</label>
        <select
          name="reason"
          className="portal-input"
          required
          value={returnReason}
          onChange={(e) => onReasonChange(e.target.value)}
        >
          <option value="" disabled hidden>{t("portal.new.selectReason")}</option>
          {reasons.map((reason) => (
            <option key={reason.id} value={reason.id}>{reason.label}</option>
          ))}
        </select>
      </div>

      {/* Resolution toggle - only show after reason is selected */}
      {returnReason && selectedReasonObj && (
        <div className="mb-3">
          {canRefund && canReplace ? (
            <div>
              <label className="portal-label">{t("portal.new.resolutionLabel")}</label>
              <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => onResolutionChange("REFUND")}
                  className={`px-4 py-2 text-sm font-medium transition-all duration-150 ${
                    returnResolution === "REFUND"
                      ? "bg-sky-600 text-white"
                      : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {t("portal.new.refund")}
                </button>
                <button
                  type="button"
                  onClick={() => onResolutionChange("EXCHANGE")}
                  className={`px-4 py-2 text-sm font-medium border-l border-gray-200 transition-all duration-150 ${
                    returnResolution === "EXCHANGE"
                      ? "bg-sky-600 text-white"
                      : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {t("portal.new.replacement")}
                </button>
              </div>
            </div>
          ) : canRefund ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 text-sky-700 text-xs font-medium">
              {t("portal.new.refund")}
            </span>
          ) : canReplace ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium">
              {t("portal.new.replacement")}
            </span>
          ) : null}
          {rxReplacementExcluded && (
            <p className="text-xs text-amber-700 mt-1.5">
              {t("portal.new.rxReplacementExcluded")}
            </p>
          )}
        </div>
      )}

      {/* Note field */}
      <div>
        <label className="portal-label">
          {t("portal.new.notesLabel")}{" "}
          {selectedReasonObj?.requiresNote ? t("portal.new.notesRequired") : t("portal.new.notesOptional")}
        </label>
        <textarea
          name="returnNote"
          rows={2}
          className="portal-input"
          placeholder={t("portal.new.notesPlaceholder")}
          value={returnNote}
          onChange={(e) => onNoteChange(e.target.value)}
          required={selectedReasonObj?.requiresNote || false}
        />
      </div>
    </div>
  );
}
