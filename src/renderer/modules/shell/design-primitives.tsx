import { Primitive } from '@radix-ui/react-primitive'
import * as RadixTabs from '@radix-ui/react-tabs'
import type { ComponentProps } from 'react'

const control = 'rounded-ui border border-solid border-app-border bg-app-raised px-2 py-1 text-app-fg'

export function Button({ type = 'button', className = '', ...props }: ComponentProps<typeof Primitive.button>) {
  return <Primitive.button type={type} className={`${control} hover:bg-app-hover ${className}`} {...props} />
}

export function Input({ className = '', ...props }: ComponentProps<typeof Primitive.input>) {
  return <Primitive.input className={`${control} ${className}`} {...props} />
}

export function Panel({ className = '', ...props }: ComponentProps<'section'>) {
  return (
    <Primitive.div asChild className="rounded-ui border border-solid border-app-border bg-app-raised p-3">
      <section className={className} {...props} />
    </Primitive.div>
  )
}

function Tab({ className = '', ...props }: ComponentProps<typeof RadixTabs.Trigger>) {
  return <RadixTabs.Trigger className={`${control} hover:bg-app-hover data-[state=active]:border-app-accent data-[state=active]:font-semibold ${className}`} {...props} />
}

export const Tabs = { Root: RadixTabs.Root, List: RadixTabs.List, Tab, Content: RadixTabs.Content }
