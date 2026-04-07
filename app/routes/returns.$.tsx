import { PortalErrorBoundary } from "~/components/portal/ErrorBoundary";

export const loader = () => {
  throw new Response("Page not found", { status: 404 });
};

export default function CatchAll() {
  return null;
}

export { PortalErrorBoundary as ErrorBoundary };
