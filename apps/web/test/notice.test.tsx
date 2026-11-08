import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTICE_SECONDS, NoticeArea, type NoticeMessage } from "../src/components/ui";
import { I18nProvider } from "../src/i18n/i18n";

function renderNotice(notice: NoticeMessage | null, onClose = vi.fn()) {
  const view = render(
    <I18nProvider initial="es">
      <NoticeArea notice={notice} onClose={onClose} />
    </I18nProvider>,
  );
  return { ...view, onClose };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("messages after an action", () => {
  it("keeps both live regions in the page, even with nothing to say", () => {
    renderNotice(null);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });

  it("closes good news on its own after a few seconds", () => {
    const { onClose } = renderNotice({ tone: "success", text: "Cambio guardado." });
    expect(screen.getByRole("status")).toHaveTextContent("Cambio guardado.");
    act(() => {
      vi.advanceTimersByTime(NOTICE_SECONDS * 1000 - 100);
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("waits while the pointer or the keyboard is on the message", () => {
    const { onClose } = renderNotice({ tone: "success", text: "Cambio guardado." });
    const box = screen.getByText("Cambio guardado.").closest(".notice");
    if (!box) throw new Error("No message box");
    fireEvent.pointerEnter(box);
    act(() => {
      vi.advanceTimersByTime(NOTICE_SECONDS * 2000);
    });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerLeave(box);
    act(() => {
      screen.getByRole("button", { name: "Cerrar aviso" }).focus();
    });
    act(() => {
      vi.advanceTimersByTime(NOTICE_SECONDS * 2000);
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      screen.getByRole("button", { name: "Cerrar aviso" }).blur();
    });
    act(() => {
      vi.advanceTimersByTime(NOTICE_SECONDS * 1000);
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("leaves errors until they are closed", () => {
    const { onClose } = renderNotice({
      tone: "error",
      text: "El cambio no se guardó.",
      details: ["Mesa 2: se pisa con la mesa 1."],
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Mesa 2: se pisa con la mesa 1.");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
