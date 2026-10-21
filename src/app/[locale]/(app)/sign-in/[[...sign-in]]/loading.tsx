/** Sign-in skeleton: the same two columns, so nothing jumps when Clerk arrives. */
export default function SignInLoading() {
  return (
    <div aria-busy="true" className="min-w-0">
      <div className="safe-x pt-3 sm:px-6">
        <div className="mx-auto flex h-[60px] max-w-[1180px] items-center justify-between">
          <span className="skeleton block h-8 w-40 rounded-full" />
          <span className="skeleton block h-9 w-24 rounded-full" />
        </div>
      </div>
      <div className="safe-x pb-20 pt-4 sm:px-6 sm:pt-10">
        <div className="mx-auto grid max-w-[1080px] items-start gap-10 lg:grid-cols-[minmax(0,1fr)_460px] lg:gap-16">
          <div className="order-2 min-w-0 lg:order-1 lg:pt-8">
            <span className="skeleton block h-3 w-44 rounded-full" />
            <span className="skeleton mt-5 block h-12 w-full max-w-md rounded-[14px]" />
            <span className="skeleton mt-3 block h-12 w-3/4 max-w-sm rounded-[14px]" />
            <span className="skeleton mt-6 block h-4 w-full max-w-md rounded-full" />
            <span className="skeleton mt-2 block h-4 w-2/3 max-w-sm rounded-full" />
            <div className="mt-10 space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-4">
                  <span className="skeleton skeleton-circle mt-2 block h-10 w-10 shrink-0" />
                  <span className="skeleton block h-[76px] flex-1 rounded-[20px]" />
                </div>
              ))}
            </div>
          </div>
          <div className="order-1 min-w-0 lg:order-2">
            <div className="pane-ink p-5 sm:p-8">
              <span className="skeleton block h-4 w-28 rounded-full" />
              <span className="skeleton mt-7 block h-7 w-56 max-w-full rounded-[10px]" />
              <span className="skeleton mt-3 block h-4 w-72 max-w-full rounded-full" />
              <span className="skeleton mt-8 block h-3 w-24 rounded-full" />
              <span className="skeleton mt-3 block h-[52px] w-full rounded-[16px]" />
              <span className="skeleton mt-5 block h-[52px] w-full rounded-full" />
              <span className="skeleton mt-6 block h-3 w-full rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
