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
          <div className="h-3 w-24 animate-pulse rounded-full bg-line" />
          <div className="mt-4 h-9 w-64 animate-pulse rounded-tile bg-line" />
          <div className="mt-3 h-4 w-96 max-w-full animate-pulse rounded-full bg-line-soft" />
        </CardBody>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <CardBody className="py-5">
              <div className="h-3 w-20 animate-pulse rounded-full bg-line-soft" />
              <div className="mt-3 h-6 w-16 animate-pulse rounded-tile bg-line" />
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardBody className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-tile border border-line bg-line-soft/40"
            />
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
