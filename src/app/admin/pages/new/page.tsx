import { saveStaticPagesAction } from "@/app/admin/actions";
import { PageEditor } from "../page-editor";

export default async function NewPage() {
  return <PageEditor title="Nowa strona" records={[]} isNew saveAction={saveStaticPagesAction} />;
}
