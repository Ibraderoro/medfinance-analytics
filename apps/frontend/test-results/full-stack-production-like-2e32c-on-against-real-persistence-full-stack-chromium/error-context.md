# Page snapshot

```yaml
- generic [ref=e3]:
  - heading "Sign in" [level=1] [ref=e4]
  - paragraph [ref=e5]: Use your MedFinance credentials to access dashboards.
  - generic [ref=e6]:
    - generic [ref=e7]:
      - generic [ref=e8]: Email
      - textbox "Email" [ref=e9]: demo@medfinance.test
    - generic [ref=e10]:
      - generic [ref=e11]: Organization ID
      - textbox "Organization ID" [ref=e12]: ff6a1c0f-6d3b-8388-6b12-4e2ad21f57c5
    - generic [ref=e13]:
      - generic [ref=e14]: Password
      - textbox "Password" [ref=e15]: demo123!
    - paragraph [ref=e16]: Invalid credentials
    - button "Sign in" [ref=e17]
    - button "Continue with enterprise SSO" [ref=e18]
    - paragraph [ref=e19]:
      - text: Don't have an account?
      - link "Register here" [ref=e20] [cursor=pointer]:
        - /url: /register
```