import { Suspense } from "react";
import { NewReel } from "@/components/molecules/NewReel";
import { PageHeader } from "@/components/molecules";

export const metadata = { title: "Create Reel" };

export default function NewProjectPage() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="hidden md:block">
        <PageHeader title="Create a new Reel" subtitle="Make a Reel from your video clips, or let the AI direct one from product photos." />
      </div>
      <Suspense>
        <NewReel />
      </Suspense>
    </div>
  );
}
