import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nevra Editor — Unique Video Generator',
  description: 'Generate algorithmically unique video variants to maximize reach across accounts.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="noise-bg antialiased">{children}</body>
    </html>
  );
}
