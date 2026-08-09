import { Card, CardBody } from "@/components/ui/card";

/**
 * Shown while a page's data resolves. Skeleton rather than a spinner, so the
 * layout doesn't jump once content arrives.
 */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <Card>
        <CardBody>
          <div className="bg-line h-3 w-24 animate-pulse rounded-full" />
          <div className="rounded-tile bg-line mt-4 h-9 w-64 animate-pulse" />
          <div className="bg-line-soft mt-3 h-4 w-96 max-w-full animate-pulse rounded-full" />
        </CardBody>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <CardBody className="py-5">
              <div className="bg-line-soft h-3 w-20 animate-pulse rounded-full" />
              <div className="rounded-tile bg-line mt-3 h-6 w-16 animate-pulse" />
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardBody className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-tile border-line bg-line-soft/40 h-20 animate-pulse border"
            />
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
