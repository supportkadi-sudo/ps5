import { useEffect, useRef, type ComponentProps } from "react";
import { Form } from "./Form";

/** Native dialog provides focus containment and restores focus on dismissal. */
export function Editor({
  title,
  onClose,
  ...form
}: ComponentProps<typeof Form> & { title: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="editor-dialog"
      aria-label={title}
      onCancel={onClose}
    >
      <button
        type="button"
        className="close"
        aria-label="Закрыть форму"
        onClick={onClose}
      >
        ×
      </button>
      <h2>{title}</h2>
      <Form {...form} />
      <button type="button" className="wide" onClick={onClose}>
        Отмена
      </button>
    </dialog>
  );
}
