<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password as PasswordRule;
use App\Models\User;

class PasswordResetController extends Controller
{
    public function request()
    {
        return view('admin.auth.forgot-password');
    }

    public function email(Request $request): RedirectResponse
    {
        $request->validate(['email' => ['required', 'email']]);

        Password::sendResetLink($request->only('email'));

        // Same response whether or not the account exists, to avoid user enumeration.
        return back()->with('status', __('admin.passwords.sent'));
    }

    public function reset(Request $request, string $token)
    {
        return view('admin.auth.reset-password', ['token' => $token, 'email' => $request->query('email'), 'invite' => $request->boolean('invite')]);
    }

    public function update(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'token' => ['required'],
            'email' => ['required', 'email'],
            'invite' => ['sometimes', 'boolean'],
            'password' => ['required', 'confirmed', PasswordRule::min(10)],
        ]);

        // Invitation links (invite=1) use the 7 day broker; ordinary resets keep 60 minutes.
        $broker = $request->boolean('invite') ? 'invites' : null;
        unset($data['invite']);

        $status = Password::broker($broker)->reset($data, function (User $user, string $password) {
            $user->forceFill(['password' => $password, 'remember_token' => Str::random(60)])->save();
            event(new PasswordReset($user));
        });

        if ($status !== Password::PASSWORD_RESET) {
            return back()->withInput($request->only('email'))
                ->withErrors(['email' => __('admin.passwords.invalid')]);
        }

        return redirect()->route('admin.login')->with('status', __('admin.passwords.reset'));
    }
}
