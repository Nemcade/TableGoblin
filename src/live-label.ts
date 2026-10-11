/** Browser-internal capture labels are not useful names in the interface. */
export function surfaceName(name: string) {
  if (/^web-contents-media-stream:/i.test(name)) return "Shared tab";
  if (/^window:\d+:\d+$/i.test(name)) return "Shared window";
  if (/^screen:\d+:\d+$/i.test(name) || (/^[A-Za-z0-9+/]{60,}={0,2}$/.test(name) && /[+/=]/.test(name))) return "Shared screen";
  return name;
}
