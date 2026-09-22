const URL_PREFIXES = ['kiwi://', 'bananas://'] as const

const unquote = (arg: string): string => {
  const trimmed = arg.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export const kiwiUrlFromArgv = (argv: readonly string[]): string | null => {
  for (let i = argv.length - 1; i >= 0; i--) {
    const arg = unquote(argv[i] ?? '')
    if (URL_PREFIXES.some((prefix) => arg.startsWith(prefix))) return arg
  }
  return null
}
