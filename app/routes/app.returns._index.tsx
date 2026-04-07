import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Filters,
  ChoiceList,
  Pagination,
  EmptyState,
  Button,
  SkeletonPage,
  SkeletonBodyText,
  Layout,
  BlockStack,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import { listReturnRequests } from "~/models/returnRequest.server";
import { STATUS_LABELS } from "~/utils/constants";
import { ReturnStatusBadge } from "~/components/admin/ReturnStatusBadge";
import type { ReturnStatus } from "@prisma/client";
import { useState, useCallback, useEffect, useRef } from "react";

const ALL_STATUSES: ReturnStatus[] = [
  "SUBMITTED", "PENDING_REVIEW", "APPROVED", "REJECTED",
  "AWAITING_SHIPMENT", "IN_TRANSIT", "RECEIVED",
  "PARTIALLY_ACCEPTED", "REFUNDED", "EXCHANGED",
  "CLOSED", "CANCELLED",
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const statusParam = url.searchParams.get("status");
  const search = url.searchParams.get("search") || undefined;
  const page = parseInt(url.searchParams.get("page") || "1");

  const statusFilter = statusParam
    ? (statusParam.split(",") as ReturnStatus[])
    : undefined;

  const result = await listReturnRequests({
    shop,
    status: statusFilter,
    search,
    page,
    pageSize: 20,
  });

  return json({ ...result, statusFilter: statusFilter || [], search: search || "" });
};

export default function ReturnsList() {
  const navigation = useNavigation();
  const { items, total, page, totalPages, statusFilter, search } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [queryValue, setQueryValue] = useState(search);
  const [showSearchButton, setShowSearchButton] = useState(false);
  const searchButtonTimer = useRef<ReturnType<typeof setTimeout>>();

  // Sync search input with URL changes (browser navigation)
  useEffect(() => {
    setQueryValue(search);
  }, [search]);

  // Debounced search button visibility
  useEffect(() => {
    clearTimeout(searchButtonTimer.current);
    if (queryValue !== search) {
      searchButtonTimer.current = setTimeout(() => setShowSearchButton(true), 300);
    } else {
      setShowSearchButton(false);
    }
    return () => {
      if (searchButtonTimer.current) {
        clearTimeout(searchButtonTimer.current);
      }
    };
  }, [queryValue, search]);

  const buildUrl = useCallback(
    (params: Record<string, string | undefined>) => {
      const newParams = new URLSearchParams(searchParams);
      Object.entries(params).forEach(([key, value]) => {
        if (value) {
          newParams.set(key, value);
        } else {
          newParams.delete(key);
        }
      });
      return `/app/returns?${newParams.toString()}`;
    },
    [searchParams],
  );

  const handleStatusFilterChange = useCallback(
    (value: string[]) => {
      navigate(buildUrl({ status: value.length > 0 ? value.join(",") : undefined, page: undefined }));
    },
    [navigate, buildUrl],
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setQueryValue(value);
    },
    [],
  );

  const handleSearchClear = useCallback(() => {
    setQueryValue("");
    navigate(buildUrl({ search: undefined, page: undefined }));
  }, [navigate, buildUrl]);

  const handleQuerySubmit = useCallback(() => {
    navigate(buildUrl({ search: queryValue || undefined, page: undefined }));
  }, [navigate, buildUrl, queryValue]);

  const handleFiltersClearAll = useCallback(() => {
    navigate("/app/returns");
    setQueryValue("");
  }, [navigate]);

  if (navigation.state === "loading") {
    return (
      <SkeletonPage primaryAction title="Returns" fullWidth>
        <Layout>
          <Layout.Section>
            <Card padding="0">
              <BlockStack gap="300">
                <div style={{ padding: "16px" }}>
                  <SkeletonBodyText lines={1} />
                </div>
                <SkeletonBodyText lines={8} />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </SkeletonPage>
    );
  }

  const resourceName = { singular: "return", plural: "returns" };

  const filters = [
    {
      key: "status",
      label: "Status",
      filter: (
        <ChoiceList
          title="Status"
          titleHidden
          choices={ALL_STATUSES.map((s) => ({
            label: STATUS_LABELS[s],
            value: s,
          }))}
          selected={statusFilter}
          onChange={handleStatusFilterChange}
          allowMultiple
        />
      ),
      shortcut: true,
    },
  ];

  const appliedFilters = statusFilter.length > 0
    ? [
        {
          key: "status",
          label: `Status: ${statusFilter.map((s: string) => STATUS_LABELS[s as ReturnStatus]).join(", ")}`,
          onRemove: () => handleStatusFilterChange([]),
        },
      ]
    : [];

  const rowMarkup = items.map((item, index) => (
    <IndexTable.Row
      id={item.id}
      key={item.id}
      position={index}
      onClick={() => navigate(`/app/returns/${item.id}`)}
    >
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {item.shopifyOrderName}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">{item.customerName}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <ReturnStatusBadge status={item.status as ReturnStatus} />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">{item.items.length}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">
          {new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </Text>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Returns"
      fullWidth
      primaryAction={{ content: "Create return", url: "/app/returns/new" }}
    >
      <Card padding="0">
        <div style={{ padding: "16px", paddingBottom: 0 }}>
          <Filters
            queryValue={queryValue}
            queryPlaceholder="Search by order #, customer name, or email"
            filters={filters}
            appliedFilters={appliedFilters}
            onQueryChange={handleSearchChange}
            onQueryClear={handleSearchClear}
            onClearAll={handleFiltersClearAll}
          />
          {showSearchButton && (
            <div style={{ marginTop: "8px" }}>
              <Button variant="plain" onClick={handleQuerySubmit}>
                Click to search
              </Button>
            </div>
          )}
        </div>

        {items.length === 0 ? (
          <div style={{ padding: "40px 16px" }}>
            <EmptyState
              heading="No returns found"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                {search || statusFilter.length > 0
                  ? "Try changing your filters or search terms."
                  : "When customers submit return requests, they'll appear here."}
              </p>
            </EmptyState>
          </div>
        ) : (
          <>
            <IndexTable
              resourceName={resourceName}
              itemCount={items.length}
              headings={[
                { title: "Order" },
                { title: "Customer" },
                { title: "Status" },
                { title: "Items" },
                { title: "Date" },
              ]}
              selectable={false}
            >
              {rowMarkup}
            </IndexTable>

            <div style={{ padding: "16px", display: "flex", justifyContent: "center" }}>
              <Pagination
                hasPrevious={page > 1}
                hasNext={page < totalPages}
                onPrevious={() => navigate(buildUrl({ page: String(page - 1) }))}
                onNext={() => navigate(buildUrl({ page: String(page + 1) }))}
              />
            </div>

            <div style={{ padding: "0 16px 16px", textAlign: "center" }}>
              <Text as="p" variant="bodySm" tone="subdued">
                Showing {items.length} of {total} returns — Page {page} of {totalPages || 1}
              </Text>
            </div>
          </>
        )}
      </Card>
    </Page>
  );
}
