"use client";

import { createAuthClient } from "better-auth/react";

// Keep authentication on this origin; Better Auth uses its /api/auth endpoint.
export const authClient = createAuthClient();
