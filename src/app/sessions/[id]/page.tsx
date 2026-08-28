import ArchiveView from "@/components/session/ArchiveView";

export default async function SessionRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ArchiveView id={id} />;
}
