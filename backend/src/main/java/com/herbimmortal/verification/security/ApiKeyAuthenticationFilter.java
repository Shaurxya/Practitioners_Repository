package com.herbimmortal.verification.security;

import com.herbimmortal.verification.service.ApiKeyService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Turns an API key into an authenticated request.
 *
 * <p>Accepts the key in either of two places, because both conventions are in
 * the wild and a developer should not have to guess which one we chose:
 *
 * <pre>
 *   X-API-Key: hi_live_...
 *   Authorization: Bearer hi_live_...
 * </pre>
 *
 * <p>The {@code hi_} prefix is what makes the second form safe to support. It
 * lets this filter and {@link JwtAuthenticationFilter} tell the two credential
 * types apart from the first characters, so neither ever hands the other's
 * credential to its parser.
 *
 * <p>The prefix has a second job that matters more. Secret scanners in CI and in
 * source hosts match on recognisable key shapes, so a key pasted into a commit
 * has a chance of being caught by something other than us. An opaque base64
 * blob is invisible to every one of them.
 *
 * <h2>Cost</h2>
 *
 * This one does read the database, unlike the JWT filter, because a key is
 * revocable and the revocation has to bite. {@link ApiKeyService} caches the
 * resolved key for a short window so a busy integration does not read the table
 * on every call, and that window is also the maximum delay between revoking a
 * key and it stopping. Both are configuration, in {@link AuthProperties}.
 */
@Component
public class ApiKeyAuthenticationFilter extends OncePerRequestFilter {

    /** Also read by {@link JwtAuthenticationFilter} to recognise what is not a JWT. */
    public static final String KEY_PREFIX = "hi_";

    private static final String HEADER = "X-API-Key";
    private static final String BEARER = "Bearer ";

    private final ApiKeyService apiKeys;

    public ApiKeyAuthenticationFilter(ApiKeyService apiKeys) {
        this.apiKeys = apiKeys;
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request,
                                    @NonNull HttpServletResponse response,
                                    @NonNull FilterChain chain)
            throws ServletException, IOException {

        String presented = presentedKey(request);

        if (presented != null && SecurityContextHolder.getContext().getAuthentication() == null) {
            apiKeys.resolve(presented).ifPresent(principal -> {
                var authentication = new UsernamePasswordAuthenticationToken(
                        principal, null, principal.getAuthorities());
                SecurityContextHolder.getContext().setAuthentication(authentication);
            });
        }

        // Like the JWT filter, this never rejects. An unusable key leaves the
        // context empty and SecurityConfig decides what that means for the
        // endpoint being called.
        chain.doFilter(request, response);
    }

    private static String presentedKey(HttpServletRequest request) {
        String direct = request.getHeader(HEADER);
        if (direct != null && direct.startsWith(KEY_PREFIX)) {
            return direct.trim();
        }

        String authorization = request.getHeader("Authorization");
        if (authorization != null && authorization.startsWith(BEARER)) {
            String value = authorization.substring(BEARER.length()).trim();
            if (value.startsWith(KEY_PREFIX)) {
                return value;
            }
        }
        return null;
    }
}
