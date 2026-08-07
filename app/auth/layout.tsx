/**
 * Layout for the auth dead-ends (`/auth/no-profile`, `/auth/inactive`).
 *
 * No nav, because someone hitting these pages doesn't have a working session to
 * navigate with — showing them a nav bar full of links that redirect straight
 * back would be confusing.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-[1400px] px-5 py-6 sm:px-8 sm:py-8">
      {children}
    </main>
  );
}
