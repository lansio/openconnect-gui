import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef(
  ({ className, type = "text", autoComplete, ...props }, ref) => {
    // Auto-generate autocomplete attribute if not provided based on field properties
    const generatedAutoComplete = (() => {
      const name = props.name || "";
      if (autoComplete) return autoComplete;
      
      // Detect common field types
      if (name.includes("user") || name.includes("email") || name.includes("login")) {
        return "username";
      }
      if (name.includes("pass") || type === "password") {
        return "current-password";
      }
      if (name.includes("pin") || name.includes("code")) {
        return "one-time-code";
      }
      return undefined;
    })();

    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        autoComplete={generatedAutoComplete}
        autocapitalize="off"
        autocomplete="on"
        spellcheck="false"
        data-lpignore="true"
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
