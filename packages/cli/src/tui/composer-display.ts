export function renderComposerDisplay(
  inputValue: string,
  placeholder: string,
): { readonly text: string; readonly isPlaceholder: boolean } {
  if (!inputValue) {
    return {
      text: placeholder,
      isPlaceholder: true,
    };
  }

  return {
    text: `${inputValue}▌`,
    isPlaceholder: false,
  };
}
