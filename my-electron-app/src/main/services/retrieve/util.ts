export const sanitizeSecret = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/^['"\s]+|['"\s]+$/g, "").trim();
};

