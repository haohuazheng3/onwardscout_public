/**
 * Clerk components sit inside the always-dark pane (.pane-ink), so they use one fixed dark
 * palette that matches the brand in both site themes: blaze for the primary action (with
 * ink text, as everywhere on the site), pine for focus rings, warm off-white ink.
 * The UserButton popover renders outside the pane, on the same dark card.
 */
export const clerkAppearance = {
  variables: {
    colorPrimary: "#FF7A50",
    colorPrimaryForeground: "#121614",
    colorBackground: "#161B18",
    colorForeground: "#F2F4F1",
    colorMuted: "#1C221E",
    colorMutedForeground: "#A3ABA6",
    colorInput: "#1C221E",
    colorInputForeground: "#F2F4F1",
    colorBorder: "rgba(242, 244, 241, 0.14)",
    colorRing: "#5FC2A0",
    colorDanger: "#FF8A5B",
    colorSuccess: "#5CC98F",
    colorWarning: "#E0B44C",
    colorNeutral: "#F2F4F1",
    colorShimmer: "rgba(242, 244, 241, 0.08)",
    colorShadow: "rgba(0, 0, 0, 0.6)",
    colorModalBackdrop: "rgba(18, 22, 20, 0.55)",
    borderRadius: "16px",
    fontFamily: "var(--font-geist), \"PingFang SC\", \"Hiragino Sans GB\", \"Noto Sans SC\", ui-sans-serif, system-ui, sans-serif",
    fontFamilyButtons: "var(--font-geist), \"PingFang SC\", \"Hiragino Sans GB\", \"Noto Sans SC\", ui-sans-serif, system-ui, sans-serif",
    fontSize: "16px",
  },
  elements: {
    rootBox: "!w-full !min-w-0",
    cardBox: "!w-full !max-w-full !min-w-0 !shadow-none !border-0 !bg-transparent",
    card: "!w-full !min-w-0 !bg-transparent !shadow-none !border-0 !p-0 !gap-6",
    header: "!text-left !items-start",
    headerTitle: "!font-display !text-[1.45rem] !font-bold !tracking-[-0.02em] !text-[#F2F4F1]",
    headerSubtitle: "!text-[#A3ABA6] !text-[0.95rem]",
    logoBox: "hidden",
    footer: "!bg-transparent !bg-none [&_*]:!bg-transparent",
    footerAction: "hidden",
    formFieldLabel: "!text-[#C9CFCB] !text-[0.88rem] !font-semibold",
    formFieldInput:
      "!min-h-[52px] !text-[16px] !rounded-[16px] !bg-[rgba(242,244,241,0.06)] !border-0 !shadow-[inset_0_0_0_1px_rgba(242,244,241,0.17)] focus:!shadow-[inset_0_0_0_2px_#5FC2A0,0_0_0_4px_rgba(95,194,160,0.16)]",
    formButtonPrimary:
      "!min-h-[52px] !rounded-full !text-[1rem] !font-semibold !normal-case !shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_10px_24px_-12px_rgba(255,122,80,0.7)] active:!scale-[0.97] !transition-transform",
    otpCodeFieldInput: "!min-h-[56px] !text-[1.3rem] !rounded-[14px]",
    formResendCodeLink: "!text-[#FF9A78] !font-semibold",
    identityPreviewEditButton: "!text-[#FF9A78]",
    alternativeMethodsBlockButton: "!rounded-full !min-h-[48px]",
    socialButtonsBlockButton: "!rounded-full !min-h-[48px]",
    dividerLine: "!bg-[rgba(242,244,241,0.12)]",
    userButtonAvatarBox: "!h-9 !w-9",
    userButtonTrigger: "!rounded-full focus:!shadow-[0_0_0_2px_#5FC2A0]",
    userButtonPopoverCard: "!rounded-[22px] !border-0",
    userButtonPopoverActionButton: "!rounded-[14px] !min-h-[44px]",
    userButtonPopoverFooter: "hidden",
  },
} as const;
