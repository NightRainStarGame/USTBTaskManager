/** 简易 className 合并工具 */
export default function clsx(...args: Array<string | false | null | undefined>): string {
  return args.filter(Boolean).join(' ');
}