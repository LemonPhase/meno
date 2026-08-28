import SessionRoute from "@/components/session/SessionRoute";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SessionRoute id={id} />;
}
