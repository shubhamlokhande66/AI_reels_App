import { Spinner } from "@/components/atoms/Spinner";

/** While a page is still on its way (a new page opened, its code or data loading): the app's loader, in the middle of
 * the screen. Next.js shows it in place of the page until the page is ready. */
export default function Loading() {
  return (
    <div className="grid min-h-[70vh] place-items-center">
      <Spinner label="Loading…" size="lg" />
    </div>
  );
}
