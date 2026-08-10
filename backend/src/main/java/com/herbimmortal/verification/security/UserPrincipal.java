package com.herbimmortal.verification.security;

import com.herbimmortal.verification.domain.Role;
import com.herbimmortal.verification.domain.User;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * Who is making this request, as Spring Security understands it.
 *
 * <p>{@link UserDetails} is the interface {@code @PreAuthorize}, {@code hasRole}
 * and {@code @AuthenticationPrincipal} all read through. Implementing it on a
 * small record of our own rather than using Spring's built in {@code User} class
 * means the controller can ask for the account id, which is what every ownership
 * check actually needs and which Spring's version does not carry.
 *
 * <p>Deliberately does not hold the password hash, unlike the usual
 * implementation. This object is attached to the request for its whole lifetime
 * and is reachable from anywhere in the call stack; the hash has no business
 * being there once authentication has already happened. {@link #getPassword()}
 * returns null because nothing downstream of the filter is allowed to check a
 * password, and returning null makes that a NullPointerException at the call
 * site rather than a silent comparison.
 *
 * @param authenticatedBy how the caller proved who they are. An API key is not a
 *                        browser session: some endpoints accept one and not the
 *                        other, and collapsing them would let a long lived key
 *                        act on screens designed around a fifteen minute token.
 */
public record UserPrincipal(
        UUID id,
        String email,
        String fullName,
        Role role,
        AuthMethod authenticatedBy
) implements UserDetails {

    public enum AuthMethod {
        /** A signed in browser or client, carrying a short lived access token. */
        SESSION,
        /** A machine, carrying an API key. */
        API_KEY
    }

    public static UserPrincipal session(User user) {
        return new UserPrincipal(user.getId(), user.getEmail(), user.getFullName(),
                user.getRole(), AuthMethod.SESSION);
    }

    public static UserPrincipal apiKey(User user) {
        return new UserPrincipal(user.getId(), user.getEmail(), user.getFullName(),
                user.getRole(), AuthMethod.API_KEY);
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of(new SimpleGrantedAuthority(role.authority()));
    }

    /**
     * Null, deliberately. See the class comment: nothing past the filter chain
     * may compare a password, and a null here turns any attempt into an
     * immediate failure rather than a comparison against an empty string.
     */
    @Override
    public String getPassword() {
        return null;
    }

    @Override
    public String getUsername() {
        return email;
    }

    /**
     * All four of Spring's account state flags answer true.
     *
     * <p>Not an oversight. Locking, disabling and expiry are checked in
     * {@code AuthService} at sign in and at every refresh, against the live row.
     * Answering them here would mean either loading the user on every single
     * request, which is the database round trip stateless tokens exist to avoid,
     * or answering from a snapshot inside a token, which is worse: it would read
     * as an authoritative "this account is fine" while being up to fifteen
     * minutes stale.
     */
    @Override public boolean isAccountNonExpired() { return true; }
    @Override public boolean isAccountNonLocked() { return true; }
    @Override public boolean isCredentialsNonExpired() { return true; }
    @Override public boolean isEnabled() { return true; }
}
