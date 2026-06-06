import { redirect } from 'next/navigation';

// The StructMigrate UI now lives at the root route (/). Keep /demo as a
// permanent redirect so old links and the nav entry don't 404.
export default function DemoPage() {
  redirect('/');
}
