function DesignSystemRuntimeStyles() {
  return (
    <style>
      {`:root{--line-2:rgba(238,232,220,.13);--line-3:rgba(238,232,220,.2);--panel-hi:#1e222b;--honey-soft:rgba(231,180,92,.13);--honey-line:rgba(231,180,92,.32);--success-soft:rgba(111,205,186,.14);--warning-soft:rgba(231,180,92,.13);--danger-soft:rgba(229,142,133,.13)}@keyframes hive-pulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,currentColor 50%,transparent)}50%{box-shadow:0 0 0 5px color-mix(in srgb,currentColor 0%,transparent)}}@keyframes hive-shimmer{100%{transform:translateX(100%)}}@keyframes hive-progress{0%{left:-40%}100%{left:100%}}@keyframes hive-breathe{0%,100%{opacity:.5}50%{opacity:1}}`}
    </style>
  );
}

export { DesignSystemRuntimeStyles };
