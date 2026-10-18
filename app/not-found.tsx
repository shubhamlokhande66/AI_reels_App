import Link from "next/link";

export const metadata = { title: "Page not found" };

/** A link that leads nowhere: say so kindly and offer the two places people usually want. */
export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 py-16 text-center">
      <span className="mono ac" style={{ fontSize: 44, lineHeight: 1 }}>
        404
      </span>
      <h1 className="h1">This page is not here</h1>
      <p className="mu sm">The link may be old, or the page has moved. Your Reels and projects are safe.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/" className="btn g">
          Go to Home
        </Link>
        <Link href="/studio" className="btn">
          Open Fast Studio
        </Link>
      </div>
    </div>
  );
}
