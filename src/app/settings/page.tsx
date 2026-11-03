import type { Metadata } from 'next';
import SettingsPage from '@/components/SettingsPage';

export const metadata: Metadata = {
  title: 'Settings – Lecture Batch Summarizer',
};

export default function Settings() {
  return <SettingsPage />;
}
