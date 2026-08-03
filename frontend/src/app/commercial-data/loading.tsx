export default function CommercialDataLoading() {
  return (
    <div aria-label="Loading Commercial Data" className="flex min-h-full flex-col">
      <div className="h-[73px] animate-pulse border-b bg-card motion-reduce:animate-none" />
      <div className="mx-auto w-full max-w-5xl flex-1 space-y-4 px-5 py-6 sm:px-7">
        <div className="h-16 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        <div className="mx-auto mt-24 h-36 max-w-md animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
      </div>
    </div>
  );
}
