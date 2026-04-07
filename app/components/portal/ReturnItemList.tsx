import { useTranslation } from "~/utils/useTranslation";

type EligibleItem = {
  lineItemId: string;
  variantId?: string | null;
  title: string;
  variantTitle?: string | null;
  sku?: string | null;
  imageUrl?: string | null;
  price: string;
  currencyCode?: string | null;
  returnableQuantity: number;
  groupedLineItemIds?: string[] | null;
  groupedItemTitles?: string[] | null;
};

type Props = {
  items: EligibleItem[];
  selectedItems: Set<string>;
  itemFormData: Record<string, { qty: string }>;
  onToggleItem: (lineItemId: string) => void;
  onQuantityChange: (lineItemId: string, qty: string) => void;
};

export function ReturnItemList({ items, selectedItems, itemFormData, onToggleItem, onQuantityChange }: Props) {
  const { t, formatCurrency } = useTranslation();

  return (
    <>
      {items.map((item) => {
        const isSelected = selectedItems.has(item.lineItemId);

        return (
          <div
            key={item.lineItemId}
            className={`portal-card cursor-pointer transition-all duration-150 ${
              isSelected
                ? "ring-2 ring-sky-600 border-sky-600 bg-sky-50/30"
                : "hover:border-gray-300 hover:shadow-sm"
            }`}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest(".item-details-section")) return;
              onToggleItem(item.lineItemId);
            }}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-150 ${
                isSelected
                  ? "bg-sky-600 border-sky-600"
                  : "border-gray-300 bg-white"
              }`}>
                {isSelected && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <input
                type="checkbox"
                name={`item_${item.lineItemId}`}
                value="1"
                checked={isSelected}
                onChange={() => onToggleItem(item.lineItemId)}
                className="sr-only"
                aria-label={`Select ${item.title}`}
              />

              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt={item.title}
                  className="w-16 h-16 object-cover rounded-lg border border-gray-200 flex-shrink-0"
                />
              ) : (
                <div className="w-16 h-16 rounded-lg border border-gray-200 flex-shrink-0 bg-gray-100 flex items-center justify-center text-gray-400 text-lg font-semibold">
                  {item.title.charAt(0)}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900">{item.title}</p>
                {item.variantTitle && (
                  <p className="text-sm text-gray-500">{item.variantTitle}</p>
                )}
                {item.groupedItemTitles && item.groupedItemTitles.length > 0 && (
                  <div className="text-xs text-gray-400 mt-0.5">
                    {item.groupedItemTitles.map((title, i) => (
                      <p key={i}>+ {title}</p>
                    ))}
                  </div>
                )}
                <p className="text-sm text-gray-700 mt-1">
                  {formatCurrency(item.price, item.currencyCode || 'USD')} &times; {item.returnableQuantity} {t("portal.new.available")}
                </p>
              </div>
            </div>

            {/* Hidden fields for item data */}
            <input type="hidden" name={`title_${item.lineItemId}`} value={item.title} />
            <input type="hidden" name={`variant_${item.lineItemId}`} value={item.variantTitle || ""} />
            <input type="hidden" name={`sku_${item.lineItemId}`} value={item.sku || ""} />
            <input type="hidden" name={`variantId_${item.lineItemId}`} value={item.variantId || ""} />
            <input type="hidden" name={`image_${item.lineItemId}`} value={item.imageUrl || ""} />
            <input type="hidden" name={`price_${item.lineItemId}`} value={item.price} />

            {isSelected && (
              <div className="item-details-section mt-4 pl-8 space-y-3 border-t border-gray-100 pt-3">
                <div>
                  <label className="portal-label">{t("portal.new.quantityLabel")}</label>
                  <select
                    name={`qty_${item.lineItemId}`}
                    className="portal-input max-w-[120px]"
                    value={itemFormData[item.lineItemId]?.qty || "1"}
                    onChange={(e) => onQuantityChange(item.lineItemId, e.target.value)}
                  >
                    {Array.from({ length: item.returnableQuantity }, (_, i) => (
                      <option key={i + 1} value={i + 1}>{i + 1}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
