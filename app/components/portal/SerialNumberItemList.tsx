import { useTranslation } from "~/utils/useTranslation";

type SerialNumberItem = {
  lineItemId: string;
  serialNumber: string;
  sapLineId: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  imageUrl: string | null;
  price: string;
  currencyCode: string;
  groupedItemTitles?: string[];
};

type Props = {
  items: SerialNumberItem[];
  selectedItems: Set<string>;
  onToggleItem: (itemKey: string) => void;
};

export function SerialNumberItemList({ items, selectedItems, onToggleItem }: Props) {
  const { formatCurrency } = useTranslation();

  return (
    <>
      {items.map((item) => {
        const itemKey = `sn_${item.serialNumber}`;
        const isSelected = selectedItems.has(itemKey);

        return (
          <div
            key={itemKey}
            className={`portal-card cursor-pointer transition-all duration-150 ${
              isSelected
                ? "ring-2 ring-sky-600 border-sky-600 bg-sky-50/30"
                : "hover:border-gray-300 hover:shadow-sm"
            }`}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest(".item-details-section")) return;
              onToggleItem(itemKey);
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
                name={itemKey}
                value="1"
                checked={isSelected}
                onChange={() => onToggleItem(itemKey)}
                className="sr-only"
                aria-label={`Select ${item.productTitle} - Serial ${item.serialNumber}`}
              />

              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt={item.productTitle}
                  className="w-16 h-16 object-cover rounded-lg border border-gray-200 flex-shrink-0"
                />
              ) : (
                <div className="w-16 h-16 rounded-lg border border-gray-200 flex-shrink-0 bg-gray-100 flex items-center justify-center text-gray-400 text-lg font-semibold">
                  {item.productTitle.charAt(0)}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900">{item.productTitle}</p>
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
                <p className="text-sm font-semibold text-sky-700 mt-1">
                  Serial: {item.serialNumber}
                </p>
                <p className="text-sm text-gray-700 mt-0.5">
                  {formatCurrency(item.price, item.currencyCode)}
                </p>
              </div>
            </div>

            {/* Hidden fields for serial number data */}
            <input type="hidden" name={`serialNumber_${item.serialNumber}`} value={item.serialNumber} />
            <input type="hidden" name={`sapLineId_${item.serialNumber}`} value={item.sapLineId} />
            <input type="hidden" name={`snLineItemId_${item.serialNumber}`} value={item.lineItemId} />
          </div>
        );
      })}
    </>
  );
}
