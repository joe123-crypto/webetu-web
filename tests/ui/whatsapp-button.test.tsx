import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WhatsAppButton } from "@/app/_components/whatsapp-button";

const MESSAGE = "Have a problem? Talk to the developer directly";

/** The arrow tab, which is the only control that expands the dock. */
function toggle() {
  return screen.getByRole("button", { name: /the WhatsApp message$/ });
}

/** The WhatsApp link, reachable by name whether or not the label is shown. */
function link() {
  return screen.getByRole("link", { name: "Talk to the developer on WhatsApp" });
}

describe("WhatsAppButton", () => {
  afterEach(() => {
    cleanup();
  });

  it("starts collapsed, with the message hidden", () => {
    render(<WhatsAppButton />);

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(MESSAGE)).not.toBeVisible();
  });

  it("reveals the message when the arrow is clicked, and hides it again", () => {
    render(<WhatsAppButton />);

    fireEvent.click(toggle());

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(MESSAGE)).toBeVisible();

    fireEvent.click(toggle());

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(MESSAGE)).not.toBeVisible();
  });

  it("points the arrow at the message it shows", () => {
    render(<WhatsAppButton />);

    const controlled = toggle().getAttribute("aria-controls");
    expect(controlled).toBeTruthy();
    expect(document.getElementById(controlled as string)).toHaveTextContent(MESSAGE);
  });

  it("opens a WhatsApp chat with the developer, greeting prefilled", () => {
    render(<WhatsAppButton />);

    expect(link()).toHaveAttribute(
      "href",
      "https://wa.me/213563719936?text=Hey%2C%20I'm%20having%20a%20problem%20with%20AWRS",
    );
    expect(link()).toHaveAttribute("target", "_blank");
    expect(link()).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("keeps the link usable by name while collapsed", () => {
    render(<WhatsAppButton />);

    expect(link()).toBeVisible();
  });
});
