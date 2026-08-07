/** Login sits outside the signed-in shell, so no nav here. */
export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-[1400px] px-5 py-10 sm:px-8">
      {children}
    </main>
  );
}
