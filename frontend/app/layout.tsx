import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hemut-Chat — Logistics Collaboration Platform',
  description:
    'Real-time team messaging and AI-powered insights for logistics operations. Track shipments, coordinate teams, and stay on top of your supply chain.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
