import { getRequestConfig } from "next-intl/server";

import { routing } from "./routing";
import messages from "../../messages/en.json";

export default getRequestConfig(async () => ({
  locale: routing.defaultLocale,
  messages,
}));
