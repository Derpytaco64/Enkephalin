import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Enkephalin',
  description: 'Drug study reference and quiz tool for pharmacy school.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
