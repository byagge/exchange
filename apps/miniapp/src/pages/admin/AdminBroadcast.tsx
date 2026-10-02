import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Megaphone, Send } from 'lucide-react';
import { adminApi } from '../../lib/adminAuth';
import { haptic } from '../../lib/api';
import { PageHead } from './PageHead';

export function AdminBroadcastPage() {
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function send() {
    if (text.trim().length < 2) {
      alert('Введите текст рассылки');
      return;
    }
    if (!confirm('Отправить сообщение всем пользователям, принявшим правила?')) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await adminApi<{ ok: number; fail: number; total: number }>(
        '/api/admin/broadcast',
        {
          method: 'POST',
          body: JSON.stringify({ text: text.trim(), parseMode: 'HTML' }),
        },
      );
      haptic('success');
      setResult(`Доставлено: ${res.ok} · ошибок: ${res.fail} · всего: ${res.total}`);
      setText('');
    } catch (e: any) {
      alert(e.message || 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHead
        title="Рассылка"
        back={
          <button
            type="button"
            className="back-btn"
            onClick={() => nav('/admin/more')}
            aria-label="Назад"
          >
            <ArrowLeft size={18} />
          </button>
        }
      />
      <p className="tiny" style={{ margin: '0 0 12px' }}>
        Сообщение уйдёт в Telegram всем активным пользователям, которые приняли правила бота.
        Поддерживается HTML (&lt;b&gt;, &lt;code&gt;, ссылки).
      </p>
      <label className="admin-field admin-field-stack">
        <span className="tiny" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Megaphone size={14} /> Текст
        </span>
        <textarea
          className="admin-textarea"
          rows={8}
          placeholder="Например: Новый курс 98.5 ₽ за USDT…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <button type="button" className="cta" disabled={busy || text.trim().length < 2} onClick={send}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Send size={16} /> {busy ? 'Отправка…' : 'Отправить всем'}
        </span>
      </button>
      {result && <p className="calc-ok" style={{ marginTop: 12 }}>{result}</p>}
    </div>
  );
}
