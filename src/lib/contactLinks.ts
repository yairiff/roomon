export const getContactLinks = (email?: string, phone?: string) => {
  const normalizedPhone = phone ? phone.replace(/[^\d+]/g, "") : "";
  const digits = normalizedPhone.replace(/[^\d]/g, "");
  const whatsappPhone = digits.startsWith("0") && digits.length === 10 ? `972${digits.slice(1)}` : digits;
  const normalizedEmail = (email || "").trim().toLowerCase();
  return {
    emailHref: normalizedEmail ? `mailto:${normalizedEmail}` : "",
    telHref: normalizedPhone ? `tel:${normalizedPhone}` : "",
    whatsappHref: whatsappPhone ? `https://wa.me/${whatsappPhone}` : ""
  };
};
