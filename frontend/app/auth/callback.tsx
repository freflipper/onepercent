import { Redirect } from 'expo-router';

// AuthProvider consumes and clears the PKCE callback before the private router is mounted.
export default function AuthCallback() { return <Redirect href="/" />; }
