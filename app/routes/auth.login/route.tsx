import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  AppProvider,
  Button,
  Card,
  FormLayout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { login } from "~/shopify.server";
import { useState } from "react";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw await login({ ...request, url: url.toString() });
  }

  return json({ showForm: Boolean(login) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = { shop: null as string | null };

  const formData = await request.formData();
  const shop = formData.get("shop");

  if (typeof shop !== "string" || !shop.trim()) {
    errors.shop = "Please enter your shop domain";
    return json({ errors });
  }

  try {
    throw await login({ ...request, url: `${new URL(request.url).origin}?shop=${shop}` });
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    errors.shop = "Something went wrong. Please try again.";
    return json({ errors });
  }
};

export default function Auth() {
  const { showForm } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");

  if (!showForm) return null;

  return (
    <AppProvider i18n={{}}>
      <Page>
        <Card>
          <Form method="post">
            <FormLayout>
              <Text variant="headingMd" as="h2">
                Log in
              </Text>
              <TextField
                type="text"
                name="shop"
                label="Shop domain"
                helpText="e.g: my-shop.myshopify.com"
                value={shop}
                onChange={setShop}
                autoComplete="on"
                error={actionData?.errors?.shop || undefined}
              />
              <Button submit>Log in</Button>
            </FormLayout>
          </Form>
        </Card>
      </Page>
    </AppProvider>
  );
}
