package com.herbimmortal.verification.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Turns {@code Authorization: Bearer <jwt>} into an authenticated request.
 *
 * <p>{@link OncePerRequestFilter} is the servlet equivalent of an Express
 * middleware, with one guarantee added: it runs at most once per request even
 * when the request is forwarded internally. Without that, an error page render
 * would re-run authentication against a request whose context is already set.
 *
 * <h2>What this filter does not do</h2>
 *
 * It does not reject anything. A missing or invalid token leaves the security
 * context empty and the request continues, and the decision about whether that
 * is allowed belongs to {@code SecurityConfig}: this endpoint is public, that
 * one is not. Rejecting here would mean every public route needed an exception
 * list in a second place.
 *
 * <p>It also does not read the database. That is the entire point of a signed
 * token: authentication costs a HMAC rather than a query. Account state, which
 * a token cannot know about because it was minted before the state changed, is
 * checked at sign in and at refresh instead. The gap is bounded by the access
 * token lifetime, which is why that is fifteen minutes and not a week.
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String HEADER = "Authorization";
    private static final String PREFIX = "Bearer ";

    private final JwtService jwt;

    public JwtAuthenticationFilter(JwtService jwt) {
        this.jwt = jwt;
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request,
                                    @NonNull HttpServletResponse response,
                                    @NonNull FilterChain chain)
            throws ServletException, IOException {

        // Already authenticated by the API key filter. Two credentials on one
        // request is not something to resolve cleverly; the first one to
        // succeed wins and the second is ignored.
        if (SecurityContextHolder.getContext().getAuthentication() != null) {
            chain.doFilter(request, response);
            return;
        }

        String token = bearerToken(request);
        if (token != null) {
            jwt.verify(token).ifPresent(claims -> {
                // Name, not email, is absent from the token on purpose: it is
                // display text that can change, and a token is a snapshot. The
                // principal carries the email so a log line can name the
                // caller; anything that needs current profile data reads /me.
                UserPrincipal principal = new UserPrincipal(
                        claims.userId(), claims.email(), claims.email(), claims.role(),
                        UserPrincipal.AuthMethod.SESSION);

                var authentication = new UsernamePasswordAuthenticationToken(
                        principal, null, principal.getAuthorities());
                authentication.setDetails(
                        new WebAuthenticationDetailsSource().buildDetails(request));
                SecurityContextHolder.getContext().setAuthentication(authentication);
            });
        }

        chain.doFilter(request, response);
    }

    private static String bearerToken(HttpServletRequest request) {
        String header = request.getHeader(HEADER);
        if (header == null || !header.startsWith(PREFIX)) {
            return null;
        }
        String value = header.substring(PREFIX.length()).trim();
        // An API key can arrive as a bearer credential too. It is not a JWT and
        // must not be handed to the JWT parser, which would log a parse failure
        // for every perfectly valid key.
        if (value.isEmpty() || value.startsWith(ApiKeyAuthenticationFilter.KEY_PREFIX)) {
            return null;
        }
        return value;
    }
}
