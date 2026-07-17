import { Step } from '@/app/lib/types';
import { CheckCircle2 } from 'lucide-react';

const labels: Record<Step, string> = {
  upload: 'Upload',
  review: 'Periksa',
  done: 'Selesai',
};

const order: Step[] = ['upload', 'review', 'done'];

export default function StepIndicator({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-2 mb-10">
      {order.map((s, i) => {
        const isActive = step === s;
        const isPast = order.indexOf(step) > order.indexOf(s);
        return (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div
              className={`flex items-center gap-2 ${
                isActive ? 'text-slate-900' : isPast ? 'text-emerald-600' : 'text-slate-400'
              }`}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium border ${
                  isActive
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : isPast
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : 'border-slate-300'
                }`}
              >
                {isPast ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
              </div>
              <span className="text-sm font-medium hidden sm:inline">{labels[s]}</span>
            </div>
            {i < 2 && <div className="flex-1 h-px bg-slate-200" />}
          </div>
        );
      })}
    </div>
  );
}