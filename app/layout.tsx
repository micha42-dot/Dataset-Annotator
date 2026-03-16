import type {Metadata} from 'next';
import { Inter, Libre_Baskerville, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const libreBaskerville = Libre_Baskerville({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-serif' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Annotator.',
  description: 'AI-powered dataset annotation tool',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={`${inter.variable} ${libreBaskerville.variable} ${jetbrainsMono.variable}`}>
      <body className={`${inter.variable} ${libreBaskerville.variable} ${jetbrainsMono.variable} font-sans antialiased bg-[#F5F5F0] text-[#1A1A1A]`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
