import { Container, Skeleton } from "@/components/ui";

/** The success pane's shape while Stripe confirms the payment and the credits are added. */
export default function CheckoutSuccessLoading() {
  return (
    <Container size="sm" className="pb-16 pt-8 sm:pt-14">
      <div className="pane p-6 sm:p-10" aria-busy="true" aria-live="polite">
        <Skeleton className="h-7 w-44 rounded-full" />
        <Skeleton className="mt-5 h-11 w-3/4 rounded-[12px]" />
        <Skeleton className="mt-4 h-4 w-full rounded-full" />
        <Skeleton className="mt-2 h-4 w-5/6 rounded-full" />
        <div className="mt-7 grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <Skeleton className="h-28 rounded-[20px]" />
          <Skeleton className="h-28 rounded-[20px]" />
        </div>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Skeleton className="h-14 w-full rounded-full sm:w-52" />
          <Skeleton className="h-14 w-full rounded-full sm:w-44" />
        </div>
      </div>
    </Container>
  );
}
