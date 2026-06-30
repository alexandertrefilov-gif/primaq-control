import { redirect } from "next/navigation";

export default function TagesabschlussPage() {
  redirect("/berichte?tab=tagesabschluss");
}
